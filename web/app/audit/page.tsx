import { Brand, FlowSteps, ShopSubnav } from "../Nav";
import PickAuditor from "./PickAuditor";

export const metadata = {
  title: "StatSeer — Pick Auditor",
  description: "Paste any bet's two sides and we strip the vig to show the fair price — so you know whether you're getting a deal or getting cheated.",
};

export default function Page() {
  return (
    <main className="wrap">
      <header className="masthead">
        <Brand
          sub={<><span className="brand__sport">Value Finder</span> · Pick Auditor</>}
          art={{ src: "/bag.png?v=1", alt: "Pick Auditor" }}
        />
      </header>
      <FlowSteps active="value" />
      <div className="subnavrow"><ShopSubnav active="auditor" /></div>
      <section className="ncf-sec">
        <h2 className="ncf-h">Is your price fair?
          <span className="ncf-h__note">strip the vig · see the true number · spot a bad deal</span>
        </h2>
        <PickAuditor />
      </section>
    </main>
  );
}
