import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Sparkles, X } from "lucide-react";
import { TimelineItem } from "./VideoEditor";

interface Effect {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  category: 'transition' | 'visual' | 'audio';
}

interface EffectsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  timelineItems: TimelineItem[];
  selectedItemId?: string;
  onApplyEffect: (effectId: string, itemId?: string) => void;
}

const AVAILABLE_EFFECTS: Effect[] = [
  {
    id: 'fade-in',
    name: 'Fade In',
    description: 'Gradually increase opacity from 0 to 100%',
    icon: TrendingUp,
    category: 'transition'
  },
  {
    id: 'fade-out',
    name: 'Fade Out',
    description: 'Gradually decrease opacity from 100% to 0',
    icon: TrendingDown,
    category: 'transition'
  }
];

export const EffectsDialog = ({
  isOpen,
  onClose,
  timelineItems,
  selectedItemId,
  onApplyEffect
}: EffectsDialogProps) => {
  const [selectedEffect, setSelectedEffect] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const filteredEffects = AVAILABLE_EFFECTS.filter(effect =>
    selectedCategory === 'all' || effect.category === selectedCategory
  );

  const categories = [
    { id: 'all', name: 'All Effects', icon: Sparkles },
    { id: 'transition', name: 'Transitions', icon: TrendingUp },
    { id: 'visual', name: 'Visual', icon: Sparkles },
    { id: 'audio', name: 'Audio', icon: TrendingDown }
  ];

  const handleEffectSelect = useCallback((effectId: string) => {
    setSelectedEffect(effectId);
  }, []);

  const handleApplyEffect = useCallback(() => {
    if (selectedEffect) {
      onApplyEffect(selectedEffect, selectedItemId);
      setSelectedEffect(null);
      onClose();
    }
  }, [selectedEffect, selectedItemId, onApplyEffect, onClose]);

  const handleClose = useCallback(() => {
    setSelectedEffect(null);
    onClose();
  }, [onClose]);

  const getEffectPreview = (effect: Effect) => {
    switch (effect.id) {
      case 'fade-in':
        return 'opacity: 0 → 100%';
      case 'fade-out':
        return 'opacity: 100% → 0';
      default:
        return effect.description;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            Effects & Transitions
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex gap-4 min-h-0">
          {/* Left Sidebar - Categories */}
          <div className="w-48 space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Categories</h3>
            {categories.map((category) => {
              const IconComponent = category.icon;
              return (
                <Button
                  key={category.id}
                  variant={selectedCategory === category.id ? "default" : "ghost"}
                  className="w-full justify-start h-9"
                  onClick={() => setSelectedCategory(category.id)}
                >
                  <IconComponent className="w-4 h-4 mr-2" />
                  {category.name}
                </Button>
              );
            })}
          </div>

          {/* Main Content - Effects Grid */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-medium">
                  {categories.find(c => c.id === selectedCategory)?.name || 'All Effects'}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {filteredEffects.length} effect{filteredEffects.length !== 1 ? 's' : ''} available
                </p>
              </div>

              {selectedItemId && (
                <div className="text-xs text-muted-foreground">
                  Applying to selected item
                </div>
              )}
            </div>

            {/* Effects Grid */}
            <div className="flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 pb-4">
                {filteredEffects.map((effect) => {
                  const IconComponent = effect.icon;
                  const isSelected = selectedEffect === effect.id;

                  return (
                    <Card
                      key={effect.id}
                      className={`
                        relative cursor-pointer transition-all duration-200 hover:scale-105 hover:shadow-lg
                        ${isSelected
                          ? 'ring-2 ring-primary bg-primary/5 border-primary'
                          : 'hover:border-muted-foreground/50'
                        }
                      `}
                      onClick={() => handleEffectSelect(effect.id)}
                    >
                      <div className="aspect-square p-4 flex flex-col items-center justify-center text-center">
                        {/* Icon */}
                        <div className={`
                          w-12 h-12 rounded-xl flex items-center justify-center mb-3 transition-colors
                          ${isSelected
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground'
                          }
                        `}>
                          <IconComponent className="w-6 h-6" />
                        </div>

                        {/* Effect Name */}
                        <h4 className="font-medium text-sm mb-1">{effect.name}</h4>

                        {/* Preview Text */}
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {getEffectPreview(effect)}
                        </p>

                        {/* Selected Indicator */}
                        {isSelected && (
                          <div className="absolute top-2 right-2 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                            <div className="w-2 h-2 bg-primary-foreground rounded-full" />
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>

              {/* Empty State */}
              {filteredEffects.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Sparkles className="w-12 h-12 text-muted-foreground/50 mb-4" />
                  <h4 className="font-medium text-muted-foreground mb-2">No effects available</h4>
                  <p className="text-sm text-muted-foreground/70">
                    More effects coming soon in this category
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            {selectedEffect ? (
              <>
                Selected: <span className="font-medium">
                  {AVAILABLE_EFFECTS.find(e => e.id === selectedEffect)?.name}
                </span>
              </>
            ) : (
              'Select an effect to apply'
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose}>
              <X className="w-4 h-4 mr-2" />
              Cancel
            </Button>

            <Button
              onClick={handleApplyEffect}
              disabled={!selectedEffect}
              className="bg-gradient-primary hover:opacity-90"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Apply Effect
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
