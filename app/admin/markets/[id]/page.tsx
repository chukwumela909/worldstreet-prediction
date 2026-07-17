import { MarketEditor } from "@/components/admin/market-editor";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditMarketPage({ params }: Props) {
  const { id } = await params;
  return <MarketEditor id={id} />;
}
