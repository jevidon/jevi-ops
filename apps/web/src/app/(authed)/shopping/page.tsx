import { shoppingApi, ApiError, type ShoppingList } from '@/lib/api';
import { ShoppingView } from './shopping-view';

// /shopping — recurring shopping lists grouped by store. Thin server
// shell: one API call for every list + item (payloads are small — this
// is a household grocery page, not a data table), hand off to the client
// view which owns the All/Needed filter and the per-row forms.

export const dynamic = 'force-dynamic';

export default async function ShoppingPage() {
  let lists: ShoppingList[] = [];
  let errorMessage: string | null = null;

  try {
    lists = (await shoppingApi.list()).lists;
  } catch (err) {
    errorMessage = err instanceof ApiError ? `API ${err.status}` : (err as Error).message;
  }

  if (errorMessage) {
    return (
      <div className="px-5 lg:px-10 pt-8">
        <h1 className="font-serif text-[40px] font-medium tracking-[-0.022em] text-ink">Shopping</h1>
        <p className="mt-4 font-sans text-[13px] text-accent">{errorMessage}</p>
      </div>
    );
  }

  return <ShoppingView lists={lists} />;
}
