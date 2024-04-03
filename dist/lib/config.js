"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.intoConfig = exports.getConfig = void 0;
const pageFetcher_1 = require("./pageFetcher");
const utils_1 = require("./utils");
const defaultMediatorConfig = {
    maxRequests: 10,
    maxMembers: 100,
};
const defaultConfig = {
    urlIsView: false,
    noShape: false,
    loose: false,
    polling: false,
    follow: false,
    url: "",
    pollInterval: 200,
    fetcher: pageFetcher_1.DefaultFetcherConfig,
    mediator: defaultMediatorConfig,
};
const defaultTarget = {
    target: {},
};
async function getConfig() {
    // TODO: Get config from params
    const extracted = {};
    // TODO: Better merging of configs
    return Object.assign({}, defaultConfig, defaultTarget, extracted);
}
exports.getConfig = getConfig;
function intoConfig(config) {
    if (!config.fetch) {
        const fetch_f = config.basicAuth
            ? (0, utils_1.handle_basic_auth)(fetch, config.basicAuth, new URL(config.url))
            : fetch;
        config.fetch = (0, utils_1.limit_fetch_per_domain)((0, utils_1.retry_fetch)(fetch_f, [408, 425, 429, 500, 502, 503, 504, 404]), 1);
    }
    return Object.assign({}, defaultConfig, defaultTarget, config);
}
exports.intoConfig = intoConfig;
