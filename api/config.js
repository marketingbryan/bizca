/* Bizca — public front-end configuration.
   Only non-secret values belong here (a Google OAuth Client ID is public by design). */

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    passwordLogin: !!process.env.BIZCA_APP_PASSWORD
  });
};
