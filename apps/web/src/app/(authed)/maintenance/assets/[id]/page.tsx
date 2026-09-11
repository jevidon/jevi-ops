import { redirect } from 'next/navigation';

// The asset page moved to /assets/[id] (0049): the asset is an area within
// its domain now, a peer of /projects/[id], not a maintenance sub-page. The
// maintenance module keeps the assets index; this keeps old links working.
export default async function LegacyAssetRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/assets/${id}`);
}
