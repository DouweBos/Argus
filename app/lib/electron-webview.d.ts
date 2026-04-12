/**
 * JSX type declarations for Electron's <webview> tag.
 *
 * Electron's webview is a custom element not part of standard HTML, so React
 * doesn't know about it. This declaration lets us use <webview> in TSX without
 * type errors.
 */

/** Runtime methods available on a mounted <webview> DOM element. */
interface ElectronWebview {
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  getURL: () => string;
  getWebContentsId: () => number;
  getZoomFactor: () => number;
  goBack: () => void;
  goForward: () => void;
  isLoading: () => boolean;
  loadURL: (url: string) => Promise<void>;
  reload: () => void;
  setUserAgent: (userAgent: string) => void;
  setZoomFactor: (factor: number) => void;
  stop: () => void;
}

declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        allowpopups?: boolean;
        disablewebsecurity?: boolean;
        httpreferrer?: string;
        nodeintegration?: boolean;
        partition?: string;
        plugins?: boolean;
        preload?: string;
        src?: string;
        useragent?: string;
        webpreferences?: string;
      },
      HTMLElement
    >;
  }
}
