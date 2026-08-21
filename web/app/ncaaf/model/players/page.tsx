import PlayerModelView from "../../../PlayerModelView";

export const metadata = {
  title: "StatSeer — College Football Player Prop Model",
  description: "Our line-blind college player-prop projections — touchdowns, passing, rushing, receiving — published and graded in public.",
};

export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const cat = typeof sp.cat === "string" ? sp.cat : "td";
  return <PlayerModelView base="ncaaf" cat={cat} />;
}
