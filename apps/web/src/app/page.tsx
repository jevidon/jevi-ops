import { redirect } from 'next/navigation';

// Root → Today. Today is the default tab per spec §4.
export default function Home() {
  redirect('/today');
}
