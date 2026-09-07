// ChatGPT selectors are intentionally confined to this adapter directory.
export const CHATGPT_SELECTORS = {
  sidebarCandidates: [
    'nav[aria-label="Chat history"]',
    'nav[aria-label*="Chat"]',
    "aside nav",
    "nav",
  ],
  conversationLink: 'a[href^="/c/"], a[href^="https://chatgpt.com/c/"]',
  menu: '[role="menu"], [data-radix-menu-content], [data-headlessui-menu-items]',
  menuItem: '[role="menuitem"]',
  button: 'button, [role="button"]',
  currentConversationMenuRegion:
    'main header, [data-testid="conversation-header"], header[data-testid*="header"]',
  sidebarSectionLabel:
    'button, [role="button"], h1, h2, h3, h4, h5, h6, [aria-label], [data-testid]',
  accountProfileButton: '[data-testid="accounts-profile-button"]',
  loggedOutAuthControl: '[data-mobile-auth-entry-action="login"], [data-testid="login-button"]',
  nativeConversationRenameEditor: 'input[name="title-editor"][aria-label="Chat title"]',
} as const;
