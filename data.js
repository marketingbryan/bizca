/* Bizca — seed data for the prototype (in-memory, mock).
   Tenant: VID. All labels in English (MVP is English-only, i18n-ready). */

window.DB = {
  company: { id: 'vid', name: 'VID', domain: 'vid.example', locale: 'en', sso: 'Microsoft 365' },

  users: [
    { id: 'u_admin', name: 'Gaia Bianchi', email: 'gaia@vid.example', role: 'admin', status: 'active' },
    { id: 'u_marco', name: 'Marco Rossi', email: 'marco@vid.example', role: 'seller', status: 'active' },
    { id: 'u_lena',  name: 'Lena Vogel',  email: 'lena@vid.example',  role: 'seller', status: 'active' },
    { id: 'u_sam',   name: 'Sam Turner',  email: 'sam@vid.example',   role: 'seller', status: 'active' },
    { id: 'u_you',   name: 'You (Seller)', email: 'you@vid.example',  role: 'seller', status: 'active' }
  ],

  // Closed lists — managed by admin only
  pickLists: {
    provenienza: [
      { id: 'p1', value: 'MECSPE 2026', active: true },
      { id: 'p2', value: 'Booth walk-in', active: true },
      { id: 'p3', value: 'Referral', active: true },
      { id: 'p4', value: 'Hannover Messe 2026', active: true }
    ],
    interesse: [
      { id: 'i1', value: 'Industrial Automation', active: true },
      { id: 'i2', value: 'Robotics', active: true },
      { id: 'i3', value: 'After-sales Service', active: true },
      { id: 'i4', value: 'Spare Parts', active: true }
    ]
  },

  // ISO country subset (one country per lead)
  countries: ['Italy','Germany','France','Spain','United Kingdom','Netherlands','Switzerland','Austria','Poland','United States','Brazil','China','India','United Arab Emirates','Turkey'],

  events: [
    { id: 'e1', name: 'MECSPE 2026', dates: 'Mar 4–6, 2026', status: 'open',
      preset: { provenienza: 'MECSPE 2026', country: 'Italy', interesse: '' } },
    { id: 'e2', name: 'Hannover Messe 2026', dates: 'Apr 20–24, 2026', status: 'open',
      preset: { provenienza: 'Hannover Messe 2026', country: 'Germany', interesse: 'Industrial Automation' } },
    { id: 'e3', name: 'Automatica 2026', dates: 'Jun 23–26, 2026', status: 'open',
      preset: { provenienza: 'Booth walk-in', country: '', interesse: 'Robotics' } }
  ],

  // Ordered rules: first match wins. Empty array = any.
  assignmentRules: [
    { id: 'r1', priority: 1, countries: ['Germany','Austria','Switzerland'], interests: [], owner: 'u_lena', active: true },
    { id: 'r2', priority: 2, countries: [], interests: ['Robotics'], owner: 'u_sam', active: true },
    { id: 'r3', priority: 3, countries: ['Italy'], interests: ['After-sales Service','Spare Parts'], owner: 'u_marco', active: true }
  ],
  fallbackOwner: 'u_marco',
  allowOverride: true,

  destinations: [
    { id: 'd_brevo', type: 'brevo', label: 'Brevo (VID CRM)', status: 'connected', detail: 'Server-side API key (Vercel env) · create/update contact, dedupe by email, BIZCA_* attributes' },
    { id: 'd_excel', type: 'excel', label: 'Excel — SharePoint', status: 'simulated', detail: 'Simulated — needs Microsoft Graph / Azure AD app with admin consent' }
  ],
  autoSend: true,
  requireConsent: false,   // when true, an on-screen signature is required before sending
  brevoApiKey: '',         // set by the admin in-app; overrides the server default when present

  // Leads captured in the app (empty on a fresh install)
  leads: [],

  syncLog: []
};

// Session state
window.SESSION = { user: null, activeEventId: 'e1', online: true };
