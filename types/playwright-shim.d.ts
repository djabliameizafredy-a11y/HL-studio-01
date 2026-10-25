// Playwright est optionnel : `npx hlstudio` doit démarrer sans Chromium.
// Ce shim suffit à typechecker `import("playwright")` quand le paquet
// n'est pas installé. S'il l'est, ses vrais types prennent le dessus.
declare module "playwright" {
  export interface Browser {
    isConnected(): boolean;
    newContext(options?: Record<string, unknown>): Promise<BrowserContext>;
    close(): Promise<void>;
  }
  export interface BrowserContext {
    newPage(): Promise<Page>;
  }
  export interface Page {
    isClosed(): boolean;
    setDefaultTimeout(ms: number): void;
    goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
    url(): string;
    title(): Promise<string>;
    click(selector: string): Promise<void>;
    fill(selector: string, value: string): Promise<void>;
    screenshot(options?: Record<string, unknown>): Promise<Buffer>;
    locator(selector: string): Locator;
    close(): Promise<void>;
  }
  export interface Locator {
    first(): Locator;
    count(): Promise<number>;
    innerText(): Promise<string>;
    getAttribute(name: string): Promise<string | null>;
  }
  export const chromium: {
    launch(options?: Record<string, unknown>): Promise<Browser>;
  };
}
