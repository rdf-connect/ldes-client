export interface ClientState {
    root: string;
    inFlight: string[];
}
export interface State {
    init(): Promise<void>;
    seen(id: string): boolean;
    filter<T>(ids: T[], getId: (item: T) => string): T[];
    add(id: string): void;
    save(): Promise<void>;
}
export declare class SimpleState implements State {
    state: Set<string>;
    location: string;
    constructor(location: string);
    init(): Promise<void>;
    filter<T>(ids: T[], getId: (item: T) => string): T[];
    seen(id: string): boolean;
    add(id: string): void;
    save(): Promise<void>;
}
export type FileStateFactoryItem<T> = {
    name: string;
    state: StateT<T>;
    serialize: (item: T) => string;
};
export interface StateFactory {
    build<T>(name: string, serialize: (item: T) => string, deserialize: (item: string) => T | undefined, create: () => T): StateT<T>;
    write(): void;
}
export declare class NoStateFactory implements StateFactory {
    build<T>(_name: string, _serialize: (item: T) => string, deserialize: (item: string) => T | undefined, create: () => T): StateT<T>;
    write(): void;
}
export declare class FileStateFactory implements StateFactory {
    private location;
    private elements;
    private found;
    constructor(location: string);
    write(): void;
    build<T>(name: string, serialize: (item: T) => string, deserialize: (item: string) => T | undefined, create: () => T): StateT<T>;
}
export declare class StateT<T> {
    item: T;
    constructor(deserialize: (item: string) => T | undefined, create: () => T, prev?: string);
}
