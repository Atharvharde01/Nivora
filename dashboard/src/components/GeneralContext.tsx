import React, { useState } from "react";
import BuyActionWindow from "./BuyActionWindow";

export interface GeneralContextType {
  openBuyWindow: (uid: string) => void;
  closeBuyWindow: () => void;
}

export interface GeneralContextProviderProps {
  children?: React.ReactNode;
}

const GeneralContext = React.createContext<GeneralContextType>({
  openBuyWindow: (_uid: string) => {},
  closeBuyWindow: () => {},
});

export const GeneralContextProvider: React.FC<GeneralContextProviderProps> = ({
  children,
}) => {
  const [isBuyWindowOpen, setIsBuyWindowOpen] = useState<boolean>(false);
  const [selectedStockUID, setSelectedStockUID] = useState<string>("");

  const handleOpenBuyWindow = (uid: string) => {
    setIsBuyWindowOpen(true);
    setSelectedStockUID(uid);
  };

  const handleCloseBuyWindow = () => {
    setIsBuyWindowOpen(false);
    setSelectedStockUID("");
  };

  return (
    <GeneralContext.Provider
      value={{
        openBuyWindow: handleOpenBuyWindow,
        closeBuyWindow: handleCloseBuyWindow,
      }}
    >
      {children}
      {isBuyWindowOpen && <BuyActionWindow uid={selectedStockUID} />}
    </GeneralContext.Provider>
  );
};

export default GeneralContext;

