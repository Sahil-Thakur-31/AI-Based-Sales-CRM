import { useEffect, useMemo, useState } from "react";
import AdminCrud from "../../../components/AdminCrud";
import API from "../../../api";

export default function Products() {

  const [taxes, setTaxes] = useState([]);

  useEffect(() => {
    loadTaxes();
  }, []);

  const loadTaxes = async () => {

    try {

      const res = await API.get("/taxes");
      setTaxes(res.data || []);

    } catch (err) {

      console.error("Failed to fetch taxes", err);
      setTaxes([]);

    }

  };

  const taxOptions = useMemo(() => ([
    { value: "", label: "0%" },
    ...taxes.map((tax) => ({
      value: tax._id,
      label: `${tax.rate}%`
    }))
  ]), [taxes]);

  const taxLabelMap = useMemo(() => (
    new Map(taxOptions.map((option) => [String(option.value), option.label]))
  ), [taxOptions]);

  return (

    <AdminCrud
      title="Products"
      endpoint="/products"
      columns={[
        { field: "name", label: "Name" },
        { field: "category", label: "Category" },
        { field: "price", label: "Price" },
        {
          field: "taxId",
          label: "Tax",
          type: "select",
          options: taxOptions,
          render: (item) => taxLabelMap.get(String(item.taxId || "")) || "0%"
        }
      ]}
    />

  );

}
