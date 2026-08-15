const test = require('node:test');
const assert = require('node:assert/strict');
const { requireAdmin } = require('../middleware/auth');

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

test('Admin-Account öffnet den gemeinsamen KRL- und WDL-Bereich', () => {
  const req = { session: { userId: 1, role: 'admin' } };
  const res = responseStub();
  let continued = false;
  requireAdmin(req, res, () => { continued = true; });

  assert.equal(continued, true);
  assert.equal(req.adminRole, 'admin');
  assert.equal(req.adminBasePath, '/admin');
});
