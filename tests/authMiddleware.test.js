const test = require('node:test');
const assert = require('node:assert/strict');
const { requireAdmin, requireWdl } = require('../middleware/auth');

function responseStub() {
  return {
    redirectTarget: null,
    redirect(target) {
      this.redirectTarget = target;
      return target;
    }
  };
}

test('WDL-Rolle wird vom vollständigen Adminbereich getrennt', () => {
  const req = { session: { userId: 7, role: 'wdl' } };
  const res = responseStub();
  let continued = false;
  requireAdmin(req, res, () => { continued = true; });

  assert.equal(continued, false);
  assert.equal(res.redirectTarget, '/admin/login');
});

test('WDL-Bereich erzwingt den eingeschränkten Ressourcenkontext', () => {
  const req = { session: { userId: 1, role: 'admin' } };
  const res = responseStub();
  let continued = false;
  requireWdl(req, res, () => { continued = true; });

  assert.equal(continued, true);
  assert.equal(req.adminRole, 'wdl');
  assert.equal(req.adminBasePath, '/wdl-admin');
});
