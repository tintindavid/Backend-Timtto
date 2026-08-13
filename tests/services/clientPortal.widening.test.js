/**
 * tests/services/clientPortal.widening.test.js
 *
 * Confirms the read-path widening (sheetwork-share-and-portal-widening):
 * portal reads now include HTs signed under any token, provided the OT is
 * in the current token's scope AND `firmaFile` is populated.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { SheetWork } from '../../src/models/sheetwork.model.js';
import { ClientAccessToken } from '../../src/models/clientAccessToken.model.js';
import { clientPortalService } from '../../src/services/clientPortal.service.js';

const TENANT = 'tenant-a';
const TOKEN_ID = '507f1f77bcf86cd799439501';
const OT_A = '507f1f77bcf86cd799439101';
const OT_B = '507f1f77bcf86cd799439102';

function chainableFind(finalArray) {
  const c = {
    populate: () => c,
    sort: () => c,
    lean: () => Promise.resolve(finalArray),
  };
  return c;
}

describe('clientPortalService.getSheetsForToken — widened', () => {
  afterEach(() => {
    delete SheetWork.find;
    delete ClientAccessToken.findById;
  });

  it('returns HTs whose otId is in token.otIds regardless of clientSignature.tokenId', async () => {
    ClientAccessToken.findById = () => ({
      select: () => ({ lean: () => Promise.resolve({ otIds: [OT_A, OT_B] }) }),
    });
    let capturedQuery = null;
    SheetWork.find = (q) => {
      capturedQuery = q;
      return chainableFind([
        {
          _id: 's1', numeroHoja: 'HT-1', otId: { _id: OT_A, Consecutivo: 'OT-A' },
          firmaFile: 'https://firebase/x.png',
          clientSignature: { signedAt: new Date(), tokenId: 'DIFFERENT-TOKEN' },
          pdfStatus: 'ready', PdfHojaTrabajo: 'https://pdf/1.pdf',
        },
      ]);
    };

    const result = await clientPortalService.getSheetsForToken(TENANT, TOKEN_ID);

    assert.deepEqual(capturedQuery.otId, { $in: [OT_A, OT_B] });
    // firmaFile filter present so unsigned sheets are excluded
    assert.ok(capturedQuery.firmaFile);
    assert.equal(result.sheets.length, 1);
    assert.equal(result.sheets[0]._id, 's1');
    // The result includes a sheet whose clientSignature.tokenId is NOT the current token
    // — that's the whole point of the widening.
  });

  it('returns empty array when the token has no otIds', async () => {
    ClientAccessToken.findById = () => ({
      select: () => ({ lean: () => Promise.resolve({ otIds: [] }) }),
    });
    const result = await clientPortalService.getSheetsForToken(TENANT, TOKEN_ID);
    assert.deepEqual(result, { sheets: [] });
  });

  it('unsigned HTs are excluded by the firmaFile filter', async () => {
    ClientAccessToken.findById = () => ({
      select: () => ({ lean: () => Promise.resolve({ otIds: [OT_A] }) }),
    });
    let capturedQuery = null;
    SheetWork.find = (q) => { capturedQuery = q; return chainableFind([]); };
    await clientPortalService.getSheetsForToken(TENANT, TOKEN_ID);
    assert.ok(capturedQuery.firmaFile.$exists === true);
    assert.equal(capturedQuery.firmaFile.$ne, null);
    assert.deepEqual(capturedQuery.firmaFile.$nin, ['']);
  });
});
