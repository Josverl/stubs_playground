// Patch setTimeout/clearTimeout to return objects with unref() (Node.js compat)
const setTimeoutOriginal = self.setTimeout.bind(self);
const clearTimeoutOriginal = self.clearTimeout.bind(self);

(self as any).setTimeout = (handler: any, timeout: any, ...args: any[]) => {
    const timeoutId = setTimeoutOriginal(handler, timeout, ...args);
    return {
        __browserTimeoutId: timeoutId,
        unref: () => {},
        ref: () => {},
        hasRef: () => false,
        refresh: () => {},
        [Symbol.toPrimitive]: () => timeoutId,
    };
};

(self as any).clearTimeout = (handler: any) => {
    if (handler && handler.__browserTimeoutId !== undefined) {
        clearTimeoutOriginal(handler.__browserTimeoutId);
    } else {
        clearTimeoutOriginal(handler);
    }
};
