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
  if (user) redirect(next && next.startsWith('/') ? next : '/');

  return (
    <div className="min-h-screen flex items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-[32px] leading-tight font-medium text-ink text-center">
          almanac<span className="text-accent">.</span>
        </h1>
        <div className="eyebrow mt-2 mb-8 text-center">A Jevi operation</div>
        <SignInForm next={next ?? '/'} />
      </div>
    </div>
  );
}
