import { redirect } from 'next/navigation';

// /assets has no index of its own: assigned assets live in their domain's
// Assets band (and on the Work board); the complete list, assigned or not,
// is the maintenance module's assets page.
export default function AssetsIndexRedirect() {
  redirect('/maintenance/assets');
}
