import { redirect } from 'next/navigation';

// The Domains index (pulse board) is retired — consolidated into /work
// (Addendum 08 §7). Domain detail pages (/domains/[id]) remain, reached from
// the Work page's section headers. This redirect keeps old links working.
export default function DomainsIndexRedirect() {
  redirect('/work');
}
