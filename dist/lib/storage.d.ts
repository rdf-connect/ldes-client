interface Storage {
    getItem(key: string): string;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
declare let storage: Storage;
export { storage };
