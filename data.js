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
    { id: 'd_brevo', type: 'brevo', label: 'Brevo (VID CRM)', status: 'connected', detail: 'List: Event Leads · 5 custom attributes mapped' },
    { id: 'd_excel', type: 'excel', label: 'Excel — SharePoint', status: 'connected', detail: 'VID Sales / Leads.xlsx · table "Leads"' }
  ],
  autoSend: true,

  // Sample cards the AI "reads" during a scan demo (cycled)
  sampleCards: [
    { first:'Andreas', last:'Keller', company:'KellerTech GmbH', role:'Head of Operations', email:'a.keller@kellertech.de', phone:'+49 151 2345678', website:'kellertech.de', address:'Industriestr. 12, Stuttgart, DE', country:'Germany' },
    { first:'Sofia', last:'Marino', company:'Marino Robotics', role:'R&D Manager', email:'sofia.marino@marinorobotics.it', phone:'+39 340 998 1122', website:'marinorobotics.it', address:'Via Torino 8, Milano, IT', country:'Italy' },
    { first:'Hiroshi', last:'Tanaka', company:'Tanaka Precision', role:'Purchasing Director', email:'h.tanaka@tanaka-prec.co.jp', phone:'+81 90 1234 5678', website:'tanaka-prec.co.jp', address:'2-1 Chuo, Osaka, JP', country:'China' },
    { first:'Claire', last:'Dubois', company:'Dubois Industrie', role:'Maintenance Lead', email:'c.dubois@dubois-ind.fr', phone:'+33 6 12 34 56 78', website:'dubois-ind.fr', address:'Rue de Lyon 4, Paris, FR', country:'France' }
  ],

  // Seeded leads across all states (for dashboard + lists)
  leads: [
    { id:'l1', first:'Thomas', last:'Berg', company:'Berg Automation AG', role:'CTO', email:'t.berg@bergauto.ch', phone:'+41 79 111 2233', website:'bergauto.ch', address:'Zurich, CH',
      provenienza:'Hannover Messe 2026', country:'Switzerland', interesse:'Industrial Automation',
      eventId:'e2', ownerId:'u_lena', createdBy:'u_you', status:'Sent', override:false, ts:Date.now()-86400000*2 },
    { id:'l2', first:'Elena', last:'Ferrari', company:'Ferrari Meccanica', role:'Buyer', email:'e.ferrari@ferrarimec.it', phone:'+39 333 444 5566', website:'ferrarimec.it', address:'Bologna, IT',
      provenienza:'MECSPE 2026', country:'Italy', interesse:'Spare Parts',
      eventId:'e1', ownerId:'u_marco', createdBy:'u_you', status:'Sent', override:false, ts:Date.now()-86400000 },
    { id:'l3', first:'David', last:'Okafor', company:'Okafor Systems', role:'Engineer', email:'david@okaforsys.com', phone:'+44 7700 900123', website:'okaforsys.com', address:'Manchester, UK',
      provenienza:'MECSPE 2026', country:'United Kingdom', interesse:'Robotics',
      eventId:'e1', ownerId:'u_sam', createdBy:'u_you', status:'Ready', override:false, ts:Date.now()-3600000*5 },
    { id:'l4', first:'Yuki', last:'Sato', company:'Sato Kogyo', role:'Manager', email:'', phone:'+81 90 8765 4321', website:'satokogyo.jp', address:'Tokyo, JP',
      provenienza:'', country:'', interesse:'', eventId:'e1', ownerId:null, createdBy:'u_you', status:'To finalize', override:false, ts:Date.now()-3600000*2 },
    { id:'l5', first:'Anna', last:'Novak', company:'Novak Industrial', role:'Director', email:'anna@novakind.pl', phone:'+48 501 234 567', website:'novakind.pl', address:'Warsaw, PL',
      provenienza:'', country:'', interesse:'', eventId:'e1', ownerId:null, createdBy:'u_you', status:'Captured', override:false, ts:Date.now()-3600000 },
    { id:'l6', first:'Luca', last:'Greco', company:'Greco SRL', role:'Owner', email:'luca@grecosrl.it', phone:'+39 348 222 1100', website:'grecosrl.it', address:'Napoli, IT',
      provenienza:'MECSPE 2026', country:'Italy', interesse:'After-sales Service',
      eventId:'e1', ownerId:'u_marco', createdBy:'u_you', status:'Error', override:false, error:'Brevo: rate limit — retry pending', ts:Date.now()-1800000 }
  ],

  syncLog: [
    { leadId:'l1', dest:'Brevo', ok:true, ts:Date.now()-86400000*2, msg:'Contact created' },
    { leadId:'l1', dest:'Excel', ok:true, ts:Date.now()-86400000*2, msg:'Row added' },
    { leadId:'l2', dest:'Brevo', ok:true, ts:Date.now()-86400000, msg:'Contact updated (dedupe by email)' },
    { leadId:'l6', dest:'Brevo', ok:false, ts:Date.now()-1800000, msg:'Rate limit (429) — retry queued' }
  ]
};

// Session state
window.SESSION = { user: null, activeEventId: 'e1', online: true };
