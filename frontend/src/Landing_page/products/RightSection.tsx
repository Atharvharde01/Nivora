import React from "react";

export interface RightSectionProps {
  imageURL: string;
  productName: string;
  productDesription: string;
  learnMore: string;
}

function RightSection({
  imageURL,
  productName,
  productDesription,
  learnMore,
}: RightSectionProps): JSX.Element {
  return (
    <div className="container mt-5">
      <div className="row">
        <div className="col-6 p-5 mt-5">
          <h1>{productName}</h1>
          <p>{productDesription}</p>
          <div>
            <a href={learnMore}>Learn More</a>
          </div>
        </div>
        <div className="col-6">
          <img src={imageURL} alt={productName} />
        </div>
      </div>
    </div>
  );
}

export default RightSection;

