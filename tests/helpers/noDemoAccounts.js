// DB-free tests that are not about demo accounts: every tenant is a regular one.
import { demoLookup } from '../../src/services/demo/demoContext.service.js';

demoLookup.find = async () => null;
