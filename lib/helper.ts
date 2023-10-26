import { TREE } from "@treecg/types";
import { Manager } from "./memberManager";
import { Helper } from "./pageFetcher";

const GTRs = [
  TREE.terms.GreaterThanRelation,
  TREE.terms.GreaterThanOrEqualRelation,
];

export function unorderedHelper(memberManager: Manager): Helper {
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
      memberManager.extractMembers(page, false);
      memberManager.marker(0, false);
    },
  };
}

export function orderedHelper(memberManager: Manager): Helper {
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
      memberManager.extractMembers(page, true);
      if (marker) {
        memberManager.marker(marker, true);
      }
    },
  };
}
