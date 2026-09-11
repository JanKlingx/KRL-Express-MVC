const { sequelize, F1RuleSection } = require('../models');
const { rulebookVersion, parseRulebook } = require('../services/rulebook');
exports.save = async (req, res) => {
  try {
    const rows = parseRulebook(req.body.sections);
    await sequelize.transaction(async (transaction) => {
      const existing = await F1RuleSection.findAll({ order: [['sortOrder', 'ASC'], ['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
      if (rulebookVersion(existing) !== req.body.version) throw new Error('Das Regelwerk wurde zwischenzeitlich geändert. Bitte neu laden und die Änderungen erneut eintragen.');
      const byId = new Map(existing.map((row) => [Number(row.id), row]));
      if (rows.some((row) => row.id && !byId.has(row.id))) throw new Error('Ein Abschnitt existiert nicht mehr.');
      for (const { id, ...values } of rows) {
        if (id) await byId.get(id).update(values, { transaction });
        else await F1RuleSection.create(values, { transaction });
      }
      const retained = new Set(rows.map((row) => row.id));
      for (const row of existing) if (!retained.has(Number(row.id))) await row.destroy({ transaction });
    });
    req.session.flash = { type: 'success', message: 'Regelwerk und Strafenkatalog gespeichert.' };
    res.redirect('/formel-1/regelwerk');
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
    // Keep the draft so validation errors do not discard the editor contents.
    req.session.rulebookDraft = { sections: String(req.body.sections || '').slice(0, 500000), version: req.body.version };
    res.redirect('/formel-1/regelwerk?edit=1');
  }
};
