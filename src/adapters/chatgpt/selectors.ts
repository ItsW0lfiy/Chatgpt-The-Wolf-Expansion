// ChatGPT selectors are intentionally confined to this adapter directory.
export const CHATGPT_SELECTORS = {
  sidebarCandidates: [
    'nav[aria-label="Chat history"]',
    'nav[aria-label*="Chat"]',
    "aside nav",
    "nav",
  ],
  conversationLink:
    'a[href^="/c/"], a[href^="/g/"], a[href^="https://chatgpt.com/c/"], a[href^="https://chatgpt.com/g/"]',
  menu: '[role="menu"], [data-radix-menu-content], [data-headlessui-menu-items]',
  menuItem: '[role="menuitem"]',
  button: 'button, [role="button"]',
  currentConversationMenuRegion:
    'main header, [data-testid="conversation-header"], header[data-testid*="header"]',
  sidebarSectionLabel:
    'button, [role="button"], h1, h2, h3, h4, h5, h6, [aria-label], [data-testid]',
  accountProfileButton:
    '[data-testid="accounts-profile-button"], button[aria-label="Open profile menu"][aria-haspopup="menu"]',
  conversationMenuTrigger:
    'button[data-conversation-options-trigger], button[aria-label="Chat actions"][aria-haspopup="menu"]',
  nativeConversationPinButton:
    'button[data-trailing-button], button[aria-label^="Pin chat"], button[aria-label^="Unpin chat"]',
  loggedOutAuthControl: '[data-mobile-auth-entry-action="login"], [data-testid="login-button"]',
  nativeConversationRenameEditor: 'input[name="title-editor"][aria-label="Chat title"]',
} as const;
