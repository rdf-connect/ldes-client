// myLibrary.ts

interface Storage {
  getItem(key: string): string;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let storage: Storage;

if (typeof window === "undefined") {
  // Node.js environment
  const fs = require("fs");

  storage = {
    getItem: (key: string): string => {
      const data = fs.readFileSync(key, "utf8");
      return data;
    },
    setItem: (key: string, value: string) => {
      fs.writeFileSync(key, value, "utf8");
    },
    removeItem: (key: string) => {
      try {
        fs.unlinkSync(key);
      } catch (error) {
        // Handle error
      }
    },
  };
} else {
  // Browser environment
  storage = {
    getItem: (key: string): string => {
      const data = localStorage.getItem(key);
      if (data) return data;
      throw "Key not found in local storage";
    },
    setItem: (key: string, value: string) => {
      localStorage.setItem(key, value);
    },
    removeItem: (key: string) => {
      localStorage.removeItem(key);
    },
  };
}

export { storage };
