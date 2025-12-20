import { storage } from "./storage";

export type FileStateFactoryItem<T> = {
    name: string;
    state: StateT<T>;
    serialize: (item: T) => string;
};

export interface StateFactory {
    build<T>(
        name: string,
        serialize: (item: T) => string,
        deserialize: (item: string) => T | undefined,
        create: () => T,
    ): StateT<T>;

    write(): void;
}

export class NoStateFactory implements StateFactory {
    build<T>(
        _name: string,
        _serialize: (item: T) => string,
        deserialize: (item: string) => T | undefined,
        create: () => T,
    ): StateT<T> {
        return new StateT<T>(deserialize, create);
    }
    write(): void { }
}

export class FileStateFactory implements StateFactory {
    private location: string;
    private elements: FileStateFactoryItem<unknown>[];
    private found: { [label: string]: string };

    constructor(location: string) {
        this.location = location;
        this.elements = [];

        this.found = {};
        try {
            const item = storage.getItem(location);
            this.found = JSON.parse(item);
        } catch (ex: unknown) {
            // pass
        }
    }

    write() {
        const out: { [label: string]: string } = {};
        for (const element of this.elements) {
            out[element.name] = element.serialize(element.state.item);
        }

        storage.setItem(this.location, JSON.stringify(out));
    }

    build<T>(
        name: string,
        serialize: (item: T) => string,
        deserialize: (item: string) => T | undefined,
        create: () => T,
    ): StateT<T> {
        const out = this.elements.find((x) => x.name == name);
        if (out) return <StateT<T>>out.state;

        const found: string | undefined = this.found[name];
        const state = new StateT<T>(deserialize, create, found);
        this.elements.push({
            name,
            serialize: <(item: unknown) => string>serialize,
            state,
        });

        return state;
    }
}

export class StateT<T> {
    item: T;
    constructor(
        deserialize: (item: string) => T | undefined,
        create: () => T,
        prev?: string,
    ) {
        const item = prev ? deserialize(prev) : create();
        if (item) {
            this.item = item;
        } else {
            this.item = create();
        }
    }
}
