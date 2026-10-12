import { getAuth } from '@/lib/auth';

const handle = (req: Request) => getAuth(req).handler(req);

export { handle as GET, handle as POST };
