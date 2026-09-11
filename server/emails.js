/* Bizca — transactional emails, in the recipient's language.

   Language is chosen per message: the locale the caller passes (the user's own
   choice, or the workspace default), falling back to English. */

const BTN = 'display:inline-block;padding:12px 22px;background:#0284C7;color:#fff;border-radius:10px;text-decoration:none;font-weight:600';
const WRAP = 'font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#0F172A;line-height:1.5';
const MUTED = 'color:#64748B;font-size:13px';

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pick = locale => (String(locale || '').toLowerCase().slice(0, 2) === 'it' ? 'it' : 'en');

const T = {
  confirm: {
    en: (o) => ({
      subject: 'Confirm your Bizca account',
      html:
        '<div style="' + WRAP + '">' +
        '<p>Hi ' + esc(o.name) + ',</p>' +
        '<p>Confirm your email address to activate the Bizca workspace for <b>' + esc(o.company) + '</b>.</p>' +
        '<p><a href="' + o.link + '" style="' + BTN + '">Confirm my email</a></p>' +
        '<p style="' + MUTED + '">Or paste this link in your browser:<br>' + o.link + '</p>' +
        '<p style="' + MUTED + '">If you did not request this, you can ignore this email.</p></div>'
    }),
    it: (o) => ({
      subject: 'Conferma il tuo account Bizca',
      html:
        '<div style="' + WRAP + '">' +
        '<p>Ciao ' + esc(o.name) + ',</p>' +
        '<p>Conferma il tuo indirizzo email per attivare lo spazio di lavoro Bizca di <b>' + esc(o.company) + '</b>.</p>' +
        '<p><a href="' + o.link + '" style="' + BTN + '">Conferma la mia email</a></p>' +
        '<p style="' + MUTED + '">Oppure incolla questo link nel browser:<br>' + o.link + '</p>' +
        '<p style="' + MUTED + '">Se non hai richiesto tu questa registrazione, ignora pure il messaggio.</p></div>'
    })
  },

  resend: {
    en: (o) => ({
      subject: 'Confirm your Bizca account',
      html:
        '<div style="' + WRAP + '">' +
        '<p>Confirm your email to activate your Bizca account.</p>' +
        '<p><a href="' + o.link + '" style="' + BTN + '">Confirm my email</a></p>' +
        '<p style="' + MUTED + '">Or paste this link in your browser:<br>' + o.link + '</p></div>'
    }),
    it: (o) => ({
      subject: 'Conferma il tuo account Bizca',
      html:
        '<div style="' + WRAP + '">' +
        '<p>Conferma la tua email per attivare l\'account Bizca.</p>' +
        '<p><a href="' + o.link + '" style="' + BTN + '">Conferma la mia email</a></p>' +
        '<p style="' + MUTED + '">Oppure incolla questo link nel browser:<br>' + o.link + '</p></div>'
    })
  },

  invite: {
    en: (o) => ({
      subject: 'You have been invited to Bizca',
      html:
        '<div style="' + WRAP + '">' +
        '<p>You have been added to the Bizca workspace of <b>' + esc(o.company) + '</b>.</p>' +
        '<p>Set your password to get started — or simply sign in with Google using this address.</p>' +
        '<p><a href="' + o.link + '" style="' + BTN + '">Activate my account</a></p>' +
        '<p style="' + MUTED + '">Bizca turns the business cards you collect at trade shows into qualified leads in your CRM.</p></div>'
    }),
    it: (o) => ({
      subject: 'Sei stato invitato su Bizca',
      html:
        '<div style="' + WRAP + '">' +
        '<p>Sei stato aggiunto allo spazio di lavoro Bizca di <b>' + esc(o.company) + '</b>.</p>' +
        '<p>Imposta la tua password per iniziare, oppure accedi con Google usando questo indirizzo.</p>' +
        '<p><a href="' + o.link + '" style="' + BTN + '">Attiva il mio account</a></p>' +
        '<p style="' + MUTED + '">Bizca trasforma i biglietti da visita raccolti in fiera in lead qualificati dentro al tuo CRM.</p></div>'
    })
  }
};

// build('invite', 'it', { company, link }) → { subject, html }
function build(kind, locale, vars) {
  const family = T[kind];
  if (!family) throw new Error('Unknown email template: ' + kind);
  return family[pick(locale)](vars || {});
}

module.exports = { build, pick };
