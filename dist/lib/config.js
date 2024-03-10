"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.intoConfig = exports.getConfig = void 0;
const pageFetcher_1 = require("./pageFetcher");
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
    return Object.assign({}, defaultConfig, defaultTarget, config);
}
exports.intoConfig = intoConfig;
