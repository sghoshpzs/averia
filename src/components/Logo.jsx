import React, { useState } from "react";
import appConfig from "../config/appConfig";

export default function Logo({ size = 44 }) {
  const [failed, setFailed] = useState(false);
  const { logoPath, logoAlt, shopName } = appConfig.brand;

  return (
    <div className="logo-wrap" style={{ height: size }}>
      {!failed && logoPath ? (
        <img
          src={logoPath}
          alt={logoAlt}
          style={{ height: size, width: size }}
          className="logo-img"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="logo-fallback" style={{ height: size, width: size }}>
          {shopName
            .split(" ")
            .map((w) => w[0])
            .slice(0, 2)
            .join("")}
        </div>
      )}
      <span className="logo-title">{shopName}</span>
    </div>
  );
}
