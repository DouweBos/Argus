Pod::Spec.new do |s|
  s.name           = 'ArgusPaste'
  s.version        = '0.1.0'
  s.summary        = "Lets iOS's native Paste action put an image into the chat input"
  s.author         = 'Houwert'
  s.homepage       = 'https://houwert.dev'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
