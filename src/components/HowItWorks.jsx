import { useLanguage } from '../context/LanguageContext.jsx'
import {
  IconLeaf,
  IconScan,
  IconTag,
  IconHandshake,
  IconPin,
  IconBoxes,
  IconRoute,
} from './Icons.jsx'

// The 7 steps really do happen in this order (listing -> grading -> pricing
// -> matching -> pickup -> aggregation -> routing), so numbering them and
// connecting them with a line is honest, not decorative.
const STEP_ICONS = [IconLeaf, IconScan, IconTag, IconHandshake, IconPin, IconBoxes, IconRoute]

export default function HowItWorks() {
  const { t } = useLanguage()
  const steps = t.howItWorks.steps

  return (
    <section className="how-it-works" id="how-it-works">
      <div className="section-inner">
        <h2>{t.howItWorks.heading}</h2>
        <p className="section-subheading">{t.howItWorks.subheading}</p>

        <ol className="step-list">
          {steps.map((step, index) => {
            const Icon = STEP_ICONS[index]
            return (
              <li className="step-item" key={step.title}>
                <div className="step-marker">
                  <span className="step-icon">
                    <Icon />
                  </span>
                  <span className="step-number">{index + 1}</span>
                </div>
                <div className="step-body">
                  <h3>{step.title}</h3>
                  <p>{step.desc}</p>
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}
