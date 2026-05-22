import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth';
import { SignInForm } from './sign-in-form';

// If you're already signed in, /sign-in just bounces you home.
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getUser();
  const { next } = await searchParams;
  if (user) redirect(next && next.startsWith('/') ? next : '/today');

  return (
    <div className="min-h-screen flex items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="eyebrow mb-2 text-center">Personal Ops</div>
        <h1 className="font-serif text-[28px] leading-tight font-medium text-ink text-center mb-8">
          Sign in
        </h1>
        <SignInForm next={next ?? '/today'} />
      </div>
    </div>
  );
}
