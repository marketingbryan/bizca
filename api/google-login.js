/* Retired: part of the first prototype, before the Bizca backend existed.
   Kept only as an explicit "gone" so nothing can use it. */
module.exports = (req, res) => { res.status(410).json({ error: 'This endpoint has been retired' }); };
