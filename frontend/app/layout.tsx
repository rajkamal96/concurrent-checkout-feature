import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DentalKart – Shop Dental Supplies",
  description:
    "Buy professional dental products online. Fast delivery, genuine products, trusted by thousands of dental professionals across India.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
