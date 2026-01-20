import slLogo from "@assets/sl.svg";
import rtLogo from "@assets/rt.svg";
import awsLogo from "@assets/aws.svg";
import claudeLogo from "@assets/claude.svg";

interface FooterProps {
  transparent?: boolean;
  sidebarOffset?: boolean;
}

export function Footer({ transparent = false, sidebarOffset = false }: FooterProps) {
  return (
    <footer className={`fixed bottom-0 right-0 h-[66px] flex items-center justify-between z-40 ${sidebarOffset ? 'left-64 px-8' : 'left-0 px-6 lg:px-[144px]'} ${transparent ? '' : 'bg-[#fafbfc]'}`}>
      <p className="font-light text-[12px] text-[#9da4ac] tracking-[-0.31px]">© {new Date().getFullYear()} Deecell, INC. All rights reserved</p>
      <div className="flex items-center gap-6">
        <span className="text-[10px] text-[#9da4ac] tracking-[1.69px] uppercase font-light">
          Our partners
        </span>
        <div className="flex items-center gap-5">
          <img src={awsLogo} alt="AWS" className="h-[20px] translate-y-[2px]" data-testid="logo-aws" />
          <img src={claudeLogo} alt="Claude" className="h-[19px]" data-testid="logo-claude" />
          <img src={rtLogo} alt="Railtracks" className="h-[12px]" data-testid="logo-railtracks" />
          <img src={slLogo} alt="SL" className="h-[18px]" data-testid="logo-sl" />
        </div>
      </div>
    </footer>
  );
}
