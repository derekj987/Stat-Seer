"use client";

// A price/prop row that doubles as an "add to slip" control — tap anywhere on the
// row to save the pick. Columns are ordered bet · price · book · edge (edge last,
// beside the book), with a heart marking whether it's on your slip.
import { useSlip, type SlipItem } from "@/lib/slip";

function BookTag({ books }: { books: string[] }) {
  return books.length === 1
    ? <span className="book">{books[0]}</span>
    : <span className="book tie" title={books.join(", ")}>×{books.length} books</span>;
}

export default function SavableRow({
  item, bet, sub, price, books, edge,
}: { item: SlipItem; bet: string; sub: string; price: string; books: string[]; edge: number }) {
  const { has, toggle } = useSlip();
  const saved = has(item.id);
  return (
    <button
      type="button"
      onClick={() => toggle(item)}
      aria-pressed={saved}
      className={saved ? "pricerow savable saved" : "pricerow savable"}
      title={saved ? "Remove from your slip" : "Add to your slip"}
    >
      <span className="pricerow__bet"><b>{bet}</b><span className="pricerow__mkt">{sub}</span></span>
      <span className="pricerow__price">{price}</span>
      <BookTag books={books} />
      <span className="pricerow__edge">+{edge.toFixed(1)}%</span>
      <span className="pricerow__heart" aria-hidden="true">{saved ? "♥" : "♡"}</span>
    </button>
  );
}
