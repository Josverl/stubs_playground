// Type declarations for non-TS imports

declare module "*.zip" {
    const content: ArrayBuffer;
    export default content;
}

declare module "*.egg" {
    const content: ArrayBuffer;
    export default content;
}
