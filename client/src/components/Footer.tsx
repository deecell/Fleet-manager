import slLogo from "@assets/sl.svg";
import rtLogo from "@assets/rt.svg";
import awsLogo from "@assets/aws.svg";
import openaiLogo from "@assets/openai.svg";

export function Footer() {
  return (
    <footer className="fixed bottom-0 left-0 right-0 bg-[#fafbfc] border-t border-[#ebeef2] h-[78px] flex items-center justify-between px-6 lg:px-[144px] z-40">
      <p className="font-light text-[12px] text-[#9da4ac] tracking-[-0.31px]">© 2026 Deecell, INC. All rights reserved</p>
      <div className="flex items-center gap-6">
        <span className="text-[10px] text-[#9da4ac] tracking-[1.69px] uppercase font-light">
          Our partners
        </span>
        <div className="flex items-center gap-5">
          <img src={openaiLogo} alt="OpenAI" className="h-[22px]" data-testid="logo-openai" />
          <img src={awsLogo} alt="AWS" className="h-[20px]" data-testid="logo-aws" />
          <img src={rtLogo} alt="Railtracks" className="h-[12px]" data-testid="logo-railtracks" />
          <img src={slLogo} alt="SL" className="h-[18px]" data-testid="logo-sl" />
        </div>
      </div>
    </footer>
  );
}
