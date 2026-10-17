import { publicRoute, json } from '@/lib/http/handler';
import { isCompanyCodeRequired } from '@/lib/auth/loginTenant';

export const dynamic = 'force-dynamic';

/** Tells the sign-in form whether a company code is needed (only when several companies exist). */
export const GET = publicRoute(async () => json({ companyRequired: await isCompanyCodeRequired() }));
