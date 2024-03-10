"use strict";
// myLibrary.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.storage = void 0;
let storage;
if (typeof window === "undefined") {
    // Node.js environment
    const fs = require("fs");
    exports.storage = storage = {
        getItem: (key) => {
            const data = fs.readFileSync(key, "utf8");
            return data;
        },
        setItem: (key, value) => {
            fs.writeFileSync(key, value, "utf8");
        },
        removeItem: (key) => {
            try {
                fs.unlinkSync(key);
            }
            catch (error) {
                // Handle error
            }
        },
    };
}
else {
    // Browser environment
    exports.storage = storage = {
        getItem: (key) => {
            const data = localStorage.getItem(key);
            if (data)
                return data;
            throw "Key not found in local storage";
        },
        setItem: (key, value) => {
            localStorage.setItem(key, value);
        },
        removeItem: (key) => {
            localStorage.removeItem(key);
        },
    };
}
