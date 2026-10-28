declare module '*.svg' {
  /** Inlined as a data URL by the build. */
  const url: string;
  export default url;
}
