/* Bizca — initial state.
   The app ships unconfigured: the first admin runs the in-app setup wizard to
   create their company. All labels in English (i18n-ready). */

window.DB = {
  // configured=false until the setup wizard completes
  company: { id: '', name: '', domain: '', locale: 'en', configured: false },

  // Users are created by the setup wizard and by admin invites
  users: [],

  // Closed lists — managed by admin only
  pickLists: {
    provenienza: [],
    interesse: []
  },

  // ISO country list (one country per lead)
  countries: ['Afghanistan','Albania','Algeria','Argentina','Australia','Austria','Bahrain','Bangladesh','Belgium','Bolivia','Bosnia and Herzegovina','Brazil','Bulgaria','Cambodia','Canada','Chile','China','Colombia','Costa Rica','Croatia','Cyprus','Czechia','Denmark','Dominican Republic','Ecuador','Egypt','Estonia','Finland','France','Georgia','Germany','Ghana','Greece','Guatemala','Hong Kong','Hungary','Iceland','India','Indonesia','Iraq','Ireland','Israel','Italy','Japan','Jordan','Kazakhstan','Kenya','Kuwait','Latvia','Lebanon','Lithuania','Luxembourg','Malaysia','Malta','Mexico','Moldova','Montenegro','Morocco','Netherlands','New Zealand','Nigeria','North Macedonia','Norway','Oman','Pakistan','Panama','Paraguay','Peru','Philippines','Poland','Portugal','Qatar','Romania','Saudi Arabia','Serbia','Singapore','Slovakia','Slovenia','South Africa','South Korea','Spain','Sri Lanka','Sweden','Switzerland','Taiwan','Thailand','Tunisia','Turkey','Ukraine','United Arab Emirates','United Kingdom','United States','Uruguay','Venezuela','Vietnam'],

  events: [],

  // Ordered rules: first match wins. Empty array = any.
  assignmentRules: [],
  fallbackOwner: null,
  allowOverride: true,

  destinations: [
    { id: 'd_brevo', type: 'brevo', label: 'Brevo (CRM)', status: 'connected', detail: 'Create/update contact, dedupe by email, BIZCA_* attributes, list per event' },
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
window.SESSION = { user: null, activeEventId: null, online: true };
