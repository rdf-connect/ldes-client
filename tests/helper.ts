import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Quad } from "@rdfjs/types";
import { Parser, Writer } from "n3";
import { Member } from "../lib/page";
import { TREE } from "@treecg/types";

export type FragmentId = number;

const BASE = "http://myTree.com/";

type Relation = {
  node: string;
  type: string;
  path?: string;
  value?: string;
};

function relationToQuads(rel: Relation): Quad[] {
  const path = rel.path ? ` tree:path <${rel.path}>;` : "";
  const value = rel.value ? ` tree:value "${rel.value}";` : "";
  const string = `
@prefix tree: <https://w3id.org/tree#>.

<> tree:relation [
  a <${rel.type}>;
  tree:node <${rel.node}>;
  ${path}
  ${value}
].
`;
  return new Parser().parse(string);
}

export async function read(stream: ReadableStream<Member>): Promise<Member[]> {
  return new Promise(async (res) => {
    const out: Member[] = [];
    const reader = stream.getReader();

    let el = await reader.read();
    while (el) {
      if (el.done || !el.value) break;
      out.push(el.value);
      el = await reader.read();
    }

    res(out);
  });
}

export class Fragment<T> {
  private members: { member: T; id: string }[] = [];
  private relations: Relation[] = [];
  delay?: number;

  constructor(delay?: number) {
    this.delay = delay;
  }

  toQuads(
    ldesId: string,
    memberToQuads: (id: string, member: T) => Quad[],
  ): Quad[] {
    const out: Quad[] = [];
    for (let rel of this.relations) {
      out.push(...relationToQuads(rel));
    }

    for (let { id, member } of this.members) {
      out.push(...new Parser().parse(`<${ldesId}> <${TREE.member}> <${id}>.`));
      out.push(...memberToQuads(id, member));
    }

    return out;
  }

  addMember(id: string, member: T): typeof this {
    this.members.push({ member, id });
    return this;
  }

  relation(target: FragmentId, type: string, path?: string, value?: string) {
    this.relations.push({
      type,
      value,
      path,
      node: BASE + target,
    });
  }
}

export class Tree<T> {
  private fragments: Fragment<T>[] = [];
  private memberToQuads: (id: string, member: T) => Quad[];
  private timestampPath?: string;

  constructor(
    memberToQuads: (id: string, member: T) => Quad[],
    timestampPath?: string,
  ) {
    this.timestampPath = timestampPath;
    this.memberToQuads = memberToQuads;
    this.fragments.push(new Fragment());
  }

  base(): string {
    return BASE;
  }

  root(): FragmentId {
    return 0;
  }

  newFragment(delay?: number): FragmentId {
    this.fragments.push(new Fragment(delay));
    return this.fragments.length - 1;
  }

  fragment(id: number): Fragment<T> {
    return this.fragments[id];
  }

  mock(): jest.Mock<typeof fetch> {
    return jest.fn(async (req, opts) => {
      if (!req.toString().startsWith(BASE)) {
        return new Response("", { status: 404 });
      }

      const quads: Quad[] = [];

      if (req.toString() === BASE + this.root()) {
        const path = this.timestampPath
          ? ` <https://w3id.org/ldes#timestampPath> <${this.timestampPath}>;`
          : "";

        quads.push(
          ...new Parser().parse(`
<> ${path}
  <https://w3id.org/tree#view> <>.
`),
        );
      }

      const index = parseInt(req.toString().substring(BASE.length));
      console.log("Handling req", req.toString());
      const fragment = this.fragments[index];
      quads.push(...fragment.toQuads(BASE + this.root(), this.memberToQuads));

      const respText = new Writer().quadsToString(quads);

      const resp = new Response(respText, {
        headers: { "content-type": "text/turtle" },
      });

      return resp;
    });
  }
}
