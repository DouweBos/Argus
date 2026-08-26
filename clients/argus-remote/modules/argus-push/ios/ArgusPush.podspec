Pod::Spec.new do |s|
  s.name           = 'ArgusPush'
  s.version        = '0.1.0'
  s.summary        = 'Shares the push decryption key with the notification service extension'
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
