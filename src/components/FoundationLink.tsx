import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export function FoundationLink() {
  return (
    <Button asChild size="lg">
      <a href="#foundation">
        Ver la base técnica
        <ArrowRight data-icon="inline-end" aria-hidden="true" />
      </a>
    </Button>
  );
}
