import { renderBrandOg } from "@/lib/ogImage";

export { size, contentType } from "@/lib/ogImage";
export const alt = "StatSeer — NFL betting analysis you can actually check";

export default function Image() {
  return renderBrandOg();
}
