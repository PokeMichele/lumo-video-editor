import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { TrendingUp, TrendingDown, Sparkles, X, Info, Filter, ZoomIn, ZoomOut } from "lucide-react";
import { TimelineItem } from "./VideoEditor";

interface Effect {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  category: 'transition' | 'visual' | 'audio';
  duration: number; // Durata predefinita in secondi
  previewHint: string; // Suggerimento per l'anteprima
  hasIntensityControl?: boolean; // Se l'effetto ha controllo intensità
  defaultIntensity?: number; // Intensità di default (0-100)
  intensityLabel?: string; // Label per lo slider
}

interface EffectsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  timelineItems: TimelineItem[];
  selectedItemId?: string;
  onApplyEffect: (effectId: string, itemId?: string, intensity?: number) => void;
}

const AVAILABLE_EFFECTS: Effect[] = [
  {
    id: 'fade-in',
    name: 'Fade In',
    description: 'Gradually increase opacity from 0 to 100%',
    icon: TrendingUp,
    category: 'transition',
    duration: 2,
    previewHint: 'Creates a smooth transition from transparent to opaque'
  },
  {
    id: 'fade-out',
    name: 'Fade Out',
    description: 'Gradually decrease opacity from 100% to 0',
    icon: TrendingDown,
    category: 'transition',
    duration: 2,
    previewHint: 'Creates a smooth transition from opaque to transparent'
  },
  {
    id: 'black-white',
    name: 'Black & White',
    description: 'Convert colors to grayscale for artistic effect',
    icon: Filter,
    category: 'visual',
    duration: 3,
    previewHint: 'Removes all color information, creating a classic black and white look'
  },
  {
    id: 'zoom-in',
    name: 'Zoom In',
    description: 'Gradually zoom into the content with customizable intensity',
    icon: ZoomIn,
    category: 'visual',
    duration: 3,
    previewHint: 'Smoothly scales up the content from normal to zoomed view',
    hasIntensityControl: true,
    defaultIntensity: 50, // 50% = 1.5x zoom
    intensityLabel: 'Zoom Level'
  },
  {
    id: 'zoom-out',
    name: 'Zoom Out',
    description: 'Gradually zoom out from the content with customizable intensity',
    icon: ZoomOut,
    category: 'visual',
    duration: 3,
    previewHint: 'Smoothly scales down the content from zoomed to normal view',
    hasIntensityControl: true,
    defaultIntensity: 50, // 50% = start from 1.5x zoom
    intensityLabel: 'Zoom Level'
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
  const [effectIntensity, setEffectIntensity] = useState<number>(50); // Intensità dell'effetto (0-100)

  const filteredEffects = AVAILABLE_EFFECTS.filter(effect =>
    selectedCategory === 'all' || effect.category === selectedCategory
  );

  const categories = [
    { id: 'all', name: 'All Effects', icon: Sparkles },
    { id: 'transition', name: 'Transitions', icon: TrendingUp },
    { id: 'visual', name: 'Visual', icon: Filter },
    { id: 'audio', name: 'Audio', icon: TrendingDown }
  ];

  const handleEffectSelect = useCallback((effectId: string) => {
    setSelectedEffect(effectId);
    // Imposta l'intensità di default quando si seleziona un effetto
    const effect = AVAILABLE_EFFECTS.find(e => e.id === effectId);
    if (effect && effect.hasIntensityControl) {
      setEffectIntensity(effect.defaultIntensity || 50);
    }
  }, []);

  const handleApplyEffect = useCallback(() => {
    if (selectedEffect) {
      const effect = AVAILABLE_EFFECTS.find(e => e.id === selectedEffect);
      const intensity = effect?.hasIntensityControl ? effectIntensity : undefined;
      onApplyEffect(selectedEffect, selectedItemId, intensity);
      setSelectedEffect(null);
      onClose();
    }
  }, [selectedEffect, selectedItemId, effectIntensity, onApplyEffect, onClose]);

  const handleClose = useCallback(() => {
    setSelectedEffect(null);
    setEffectIntensity(50);
    onClose();
  }, [onClose]);

  const getEffectPreview = (effect: Effect) => {
    switch (effect.id) {
      case 'fade-in':
        return `opacity: 0 → 100% (${effect.duration}s)`;
      case 'fade-out':
        return `opacity: 100% → 0 (${effect.duration}s)`;
      case 'black-white':
        return `color → grayscale (${effect.duration}s)`;
      case 'zoom-in':
        return `zoom: 0% → ${effectIntensity}% (${effect.duration}s)`;
      case 'zoom-out':
        return `zoom: ${effectIntensity}% → 0% (${effect.duration}s)`;
      default:
        return `${effect.description} (${effect.duration}s)`;
    }
  };

  const selectedEffectData = selectedEffect ? AVAILABLE_EFFECTS.find(e => e.id === selectedEffect) : null;

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
                            : 'bg-red-600 text-white'
                          }
                        `}>
                          <IconComponent className="w-6 h-6" />
                        </div>

                        {/* Effect Name */}
                        <h4 className="font-medium text-sm mb-1">{effect.name}</h4>

                        {/* Preview Text */}
                        <p className="text-xs text-muted-foreground line-clamp-2 mb-1">
                          {getEffectPreview(effect)}
                        </p>

                        {/* Duration badge */}
                        <span className="text-[10px] bg-red-500/20 text-red-600 px-2 py-0.5 rounded-full">
                          {effect.duration}s
                        </span>

                        {/* Intensity Control Indicator */}
                        {effect.hasIntensityControl && (
                          <div className="absolute top-2 left-2 w-3 h-3 bg-blue-500 rounded-full flex items-center justify-center">
                            <div className="w-1 h-1 bg-white rounded-full" />
                          </div>
                        )}

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

          {/* Right Sidebar - Effect Details */}
          {selectedEffectData && (
            <div className="w-64 space-y-4">
              <div className="border rounded-lg p-4">
                <h3 className="font-medium text-sm mb-3 flex items-center gap-2">
                  <Info className="w-4 h-4" />
                  Effect Details
                </h3>
                
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Name</p>
                    <p className="text-sm">{selectedEffectData.name}</p>
                  </div>
                  
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Duration</p>
                    <p className="text-sm">{selectedEffectData.duration} seconds</p>
                  </div>
                  
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Category</p>
                    <p className="text-sm capitalize">{selectedEffectData.category}</p>
                  </div>

                  {/* NUOVO: Controllo Intensità per effetti Zoom */}
                  {selectedEffectData.hasIntensityControl && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">
                        {selectedEffectData.intensityLabel || 'Intensity'}
                      </p>
                      <div className="space-y-2">
                        <Slider
                          value={[effectIntensity]}
                          onValueChange={(value) => setEffectIntensity(value[0])}
                          max={100}
                          min={0}
                          step={1}
                          className="w-full"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>0%</span>
                          <span className="font-medium">{effectIntensity}%</span>
                          <span>100%</span>
                        </div>
                        {(selectedEffectData.id === 'zoom-in' || selectedEffectData.id === 'zoom-out') && (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {selectedEffectData.id === 'zoom-in' 
                              ? `Zooms from normal size to ${effectIntensity}% magnification`
                              : `Zooms from ${effectIntensity}% magnification to normal size`}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
                    <p className="text-xs text-muted-foreground">{selectedEffectData.description}</p>
                  </div>
                  
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Preview</p>
                    <p className="text-xs text-muted-foreground">{selectedEffectData.previewHint}</p>
                  </div>
                </div>

                {/* Color indicator per la timeline */}
                <div className="mt-3 pt-3 border-t">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Timeline Appearance</p>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 bg-red-600 rounded border"></div>
                    <span className="text-xs text-muted-foreground">Effects appear in red</span>
                  </div>
                  {selectedEffectData.hasIntensityControl && (
                    <div className="flex items-center gap-2 mt-1">
                      <div className="w-4 h-4 bg-blue-500 rounded-full border"></div>
                      <span className="text-xs text-muted-foreground">Customizable intensity</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            {selectedEffect ? (
              <>
                Selected: <span className="font-medium">
                  {AVAILABLE_EFFECTS.find(e => e.id === selectedEffect)?.name}
                </span>
                {selectedEffectData?.hasIntensityControl && (
                  <span className="ml-2 text-xs">
                    ({effectIntensity}% intensity)
                  </span>
                )}
                {selectedItemId ? (
                  <span className="ml-2 text-xs">(will be applied to selected item)</span>
                ) : (
                  <span className="ml-2 text-xs">(will be added at current time)</span>
                )}
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