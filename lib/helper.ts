import { TREE } from "@treecg/types";
import { Manager } from "./memberManager";
import { Helper } from "./pageFetcher";

import debug from "debug";
const log = debug("helper");

const GTRs = [
  TREE.terms.GreaterThanRelation,
  TREE.terms.GreaterThanOrEqualRelation,
];

export function unorderedHelper(memberManager: Manager): Helper {
  const logger = log.extend("unordered");
  return {
    extractRelation: (rel) => {
      return {
        node: rel.node,
        rel: {
          important: false,
          value: 0,
        },
      };
    },

    handleFetchedPage: (page, _) => {
      logger("fetched page");
      memberManager.extractMembers(page, false);
      memberManager.marker(0, false, false);
    },
    close: async () => {
      logger("close");
      await memberManager.close();
    },
  };
}

export function orderedHelper(memberManager: Manager): Helper {
  const logger = log.extend("ordered");
  return {
    extractRelation: (rel) => {
      if (GTRs.some((x) => rel.type.equals(x))) {
        return {
          node: rel.node,
          rel: {
            important: true,
            // Maybe this should create a date
            value: rel.value![0].value,
          },
        };
      } else {
        return {
          node: rel.node,
          rel: {
            important: false,
            value: 0,
          },
        };
      }
    },

    handleFetchedPage: (page, marker) => {
      logger("fetched page");
      memberManager.extractMembers(page, true);
      if (marker) {
        memberManager.marker(marker, true, false);
      }
    },
    close: async () => {
      logger("close");
      // await memberManager.marker(undefined, true, true);
      logger("Closing helper");
      await memberManager.close();
    },
  };
}
